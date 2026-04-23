/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "FileItem.h"

#import "DirectoryItem.h"
#import "PreferencesPanelControl.h"


NSString*  FileSizeUnitSystemBase2 = @"base-2";
NSString*  FileSizeUnitSystemBase10 = @"base-10";

@interface FileItem (PrivateMethods)

+ (NSString *)filesizeUnitString:(int)order;
+ (NSString *)decimalSeparator;

+ (CFDateFormatterRef) timeFormatter;

- (NSString *)constructPath:(BOOL)useFileSystemRepresentation;

@end


@implementation FileItem

+ (NSArray *) fileSizeUnitSystemNames {
  static NSArray  *fileSizeMeasureBaseNames = nil;
  
  if (fileSizeMeasureBaseNames == nil) {
    fileSizeMeasureBaseNames = [@[FileSizeUnitSystemBase2, FileSizeUnitSystemBase10] retain];
  }
  
  return fileSizeMeasureBaseNames;
}

+ (int) bytesPerKilobyte {
  NSString*  fileSizeMeasureBase =
    [NSUserDefaults.standardUserDefaults stringForKey: FileSizeUnitSystemKey];

  if ([fileSizeMeasureBase isEqualToString: FileSizeUnitSystemBase10]) {
    return 1000;
  } else {
    // Assume binary (also when value is unrecognized/invalid)
    return 1024;
  }
}

- (instancetype) initWithLabel:(NSString *)label
                        parent:(DirectoryItem *)parent
                          size:(item_size_t)size
                         flags:(FileItemOptions)fileItemFlags
                  creationTime:(CFAbsoluteTime)creationTime
              modificationTime:(CFAbsoluteTime)modificationTime
                    accessTime:(CFAbsoluteTime)accessTime {
  if (self = [super initWithItemSize: size]) {
    _label = [label retain];

    _parentDirectory = parent; // not retaining it, as it is not owned.
    _fileItemFlags = fileItemFlags;
    
    _creationTime = creationTime;
    _modificationTime = modificationTime;
    _accessTime = accessTime;
  }
  return self;
}
  
- (void) dealloc {
  [_label release];

  [super dealloc];
}


- (FileItem *)duplicateFileItem:(DirectoryItem *)newParent {
  NSAssert(NO, @"-duplicateFileItem: called on (abstract) FileItem.");
  return nil;
}


- (NSString *)description {
  return [NSString stringWithFormat:@"FileItem(%@, %qu)", self.label, self.itemSize];
}


- (file_count_t) numFiles {
  return 1;
}

- (BOOL) isAncestorOfFileItem:(FileItem *)fileItem {
  do {
    if (fileItem == self) {
      return YES;
    }
    fileItem = fileItem.parentDirectory;
  } while (fileItem != nil);
  
  return NO;
}


- (BOOL) isDirectory {
  return NO;
}


- (BOOL) isPhysical {
  return (self.fileItemFlags & FileItemIsNotPhysical) == 0;
}

- (BOOL) isHardLinked {
  return (self.fileItemFlags & FileItemIsHardlinked) != 0;
}

- (BOOL) isPackage {
  return (self.fileItemFlags & FileItemIsPackage) != 0;
}


- (NSString *)pathComponent {
  if (!self.isPhysical) {
    return nil;
  }

  return [FileItem friendlyPathComponentFor: self.label];
}

- (NSString *)path {
  return [self constructPath: NO];
}

- (NSString *)systemPath {
  return [self constructPath: YES];
}

+ (NSString *)stringForFileItemSize:(item_size_t)filesize {
  int  bytesUnit = FileItem.bytesPerKilobyte;
  
  if (filesize < bytesUnit) {
    // Definitely don't want a decimal point here
    NSString  *byteSizeUnit = NSLocalizedString(@"B", @"File size unit for bytes.");
    return [NSString stringWithFormat: @"%qu %@", filesize, byteSizeUnit];
  }

  double  n = (double)filesize / bytesUnit;
  int  m = 0;
  // Note: The threshold for "n" is chosen to cope with rounding, ensuring that the string for
  // n = 1024^3 becomes "1.00 GB" instead of "1024 MB"
  while (n > (bytesUnit - 0.001) && m < 3) {
    m++;
    n /= bytesUnit; 
  }

  NSMutableString*  s = [[[NSMutableString alloc] initWithCapacity: 12] autorelease];
  [s appendFormat:@"%.2f", n];
  
  // Ensure that only the three most-significant digits are shown.
  // Exception: If there are four digits before the decimal point, all four are shown.
  
  NSRange  dotRange = [s rangeOfString: @"."];
  if (dotRange.location != NSNotFound) {
    NSUInteger  delPos = (dotRange.location < 3
                          ? 4                   // Keep one or more digits after the decimal point.
                          : dotRange.location); // Keep only the digits before the decimal point.

    [s deleteCharactersInRange: NSMakeRange(delPos, s.length - delPos)];
    
    if (dotRange.location < delPos) {
      // The dot is still visible, so localize it
      
      [s replaceCharactersInRange: dotRange withString: FileItem.decimalSeparator];
    }
  }
  else {
    // Void. We always expect a dot (even if the user has set a different decimal separator in his
    // I18N settings). So this should not really happen, but raise no fuss if it does anyway.
  }

  [s appendFormat:@" %@", [FileItem filesizeUnitString: m]];

  return s;
}


+ (NSString *)stringForTime:(CFAbsoluteTime)absTime {
  if (absTime == 0) {
    return @"";
  } else {
    return [
      (NSString *)CFDateFormatterCreateStringWithAbsoluteTime(NULL, self.timeFormatter, absTime)
        autorelease
    ];
  }
}

/* Returns path component as it is displayed to user, with colons replaced by slashes.
 */
+ (NSString *)friendlyPathComponentFor:(NSString *)pathComponent {
  NSMutableString  *comp = [NSMutableString stringWithString: pathComponent];
  [comp replaceOccurrencesOfString: @":"
                        withString: @"/"
                           options: NSLiteralSearch
                             range: NSMakeRange(0, comp.length)];
  return comp;
}

/* Returns path component as it is used by system, with slashes replaced by colons.
 */
+ (NSString *)systemPathComponentFor:(NSString *)pathComponent {
  NSMutableString  *comp = [NSMutableString stringWithString: pathComponent];
  [comp replaceOccurrencesOfString: @"/"
                        withString: @":"
                           options: NSLiteralSearch
                             range: NSMakeRange(0, comp.length)];
  return comp;
}

@end // @implementation FileItem


@implementation FileItem (ProtectedMethods)

- (NSString *)systemPathComponent {
  // Only physical items contribute to the path.
  return self.isPhysical ? self.label : nil;
}
    
@end // @implementation FileItem (ProtectedMethods)


@implementation FileItem (PrivateMethods)

+ (NSString *)filesizeUnitString:(int)order {
  switch (order) {
    case 0: return NSLocalizedString(@"kB", @"File size unit for kilobytes.");
    case 1: return NSLocalizedString(@"MB", @"File size unit for megabytes.");
    case 2: return NSLocalizedString(@"GB", @"File size unit for gigabytes.");
    case 3: return NSLocalizedString(@"TB", @"File size unit for terabytes.");
    default: NSAssert(NO, @"Unexpected order value"); return @"";
  }
}


+ (NSString *)decimalSeparator {
  static NSString  *decimalSeparator = nil;

  if (decimalSeparator == nil) {
    NSNumberFormatter  *numFormat = [[[NSNumberFormatter alloc] init] autorelease];
    [numFormat setLocalizesFormat: YES];
    decimalSeparator = [numFormat.decimalSeparator retain];
  }

  return decimalSeparator;
}


+ (CFDateFormatterRef) timeFormatter {
  static CFDateFormatterRef dateFormatter = NULL;
  
  if (dateFormatter == NULL) {
    // Lazily create formatter
    dateFormatter = CFDateFormatterCreate(NULL, NULL, 
                                          kCFDateFormatterShortStyle, 
                                          kCFDateFormatterShortStyle);    
  }
  
  return dateFormatter;
}


- (NSString *)constructPath:(BOOL) useFileSystemRepresentation {
  NSString  *comp = useFileSystemRepresentation ? self.systemPathComponent : self.pathComponent;
  
  if (comp != nil) {
    return (self.parentDirectory != nil
            ? [[self.parentDirectory constructPath: useFileSystemRepresentation]
                  stringByAppendingPathComponent: comp]
            : comp);
  }
  else {
    return (self.parentDirectory != nil
            ? [self.parentDirectory constructPath: useFileSystemRepresentation]
            : @"");
  }
}

@end // @implementation FileItem (PrivateMethods)
