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

#import "NSURL.h"


@implementation NSURL (HelperMethods)

- (BOOL) isDirectory {
  NSError  *error = nil;
  NSNumber  *isDirectory;
  
  [self getResourceValue: &isDirectory forKey: NSURLIsDirectoryKey error: &error];
  if (error != nil) {
    NSLog(@"Failed to obtain directory status for %@: %@", self, error.description);
    return NO;
  }
  
  return isDirectory.boolValue;
}

- (BOOL) isPackage {
  NSError  *error = nil;
  NSNumber  *isPackage;
  
  [self getResourceValue: &isPackage forKey: NSURLIsPackageKey error: &error];
  if (error != nil) {
    NSLog(@"Failed to obtain package status for %@: %@", self, error.description);
    return NO;
  }
  
  return isPackage.boolValue;
}

- (BOOL) isHardLinked {
  NSNumber  *linkCount;
  NSError  *error = nil;
  
  [self getResourceValue: &linkCount forKey: NSURLLinkCountKey error: &error];
  if (error != nil) {
    NSLog(@"Failed to obtain link count for %@: %@", self, error.description);
    return NO;
  }
  
  return linkCount.integerValue > 1;
}

- (CFAbsoluteTime) creationTime {
  NSDate  *creationTime;
  NSError  *error = nil;
  
  [self getResourceValue: &creationTime forKey: NSURLCreationDateKey error: &error];
  if (error != nil) {
    NSLog(@"Failed to obtain creation time for %@: %@", self, error.description);
    return NO;
  }
  
  return creationTime.timeIntervalSinceReferenceDate;
}

- (CFAbsoluteTime) modificationTime {
  NSDate  *modificationTime;
  NSError  *error = nil;
  
  [self getResourceValue: &modificationTime forKey: NSURLContentModificationDateKey error: &error];
  if (error != nil) {
    NSLog(@"Failed to obtain modification time for %@: %@", self, error.description);
    return NO;
  }
  
  return modificationTime.timeIntervalSinceReferenceDate;
}

- (CFAbsoluteTime) accessTime {
  NSDate  *accessTime;
  NSError  *error = nil;
  
  [self getResourceValue: &accessTime forKey: NSURLContentAccessDateKey error: &error];
  if (error != nil) {
    NSLog(@"Failed to obtain access time for %@: %@", self, error.description);
    return NO;
  }
  
  return accessTime.timeIntervalSinceReferenceDate;
}

- (void) getParentURL:(out NSURL* _Nullable *_Nonnull)parentURL {
  *parentURL = [self URLByDeletingLastPathComponent];

//  // Unfortunately, the code below is still not robust enough. On Catalina, for files inside
//  // "/System/Volumes/Data" the parent URL that is returned is "file:///". Therefore disabling
//  // it for now.
//
//  NSError  *error = nil;
//
//  [self getResourceValue: parentURL forKey: NSURLParentDirectoryURLKey error: &error];
//  if (error != nil) {
//    NSLog(@"Failed to obtain parent URL for %@: %@", self, error.description);
//  }
//  if (*parentURL == nil) {
//    NSLog(@"Warning: parent URL is nil for %@", self);
//
//    // Try to construct parent URL by stripping last path component from own path
//    NSURL  *parent = [self URLByDeletingLastPathComponent];
//    NSLog(@"Setting parent to %@", parent);
//    *parentURL = parent;
//  }
}

+ (NSArray *_Nonnull)supportedPasteboardTypes {
  return @[NSPasteboardTypeFileURL, NSPasteboardTypeURL, NSPasteboardTypeString];
}

+ (NSURL *)getFileURLFromPasteboard:(NSPasteboard *)pboard {
  NSString  *bestType = [pboard availableTypeFromArray: [NSURL supportedPasteboardTypes]];
  if (bestType == nil) {
    return nil;
  }

  if ([bestType isEqualToString: NSPasteboardTypeFileURL]
      || [bestType isEqualToString: NSPasteboardTypeURL]) {
    return [NSURL URLFromPasteboard: pboard].filePathURL;
  }
  else if ([bestType isEqualToString: NSPasteboardTypeString]) {
    return [NSURL fileURLWithPath: [pboard stringForType: NSPasteboardTypeString]];
  }

  return nil;
}

@end
