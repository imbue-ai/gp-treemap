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

#import "PlainFileItem.h"

#import "DirectoryItem.h"
#import "UniformType.h"

@implementation PlainFileItem

// Overrides designated initialiser
- (instancetype) initWithLabel:(NSString *)label
                        parent:(DirectoryItem *)parent
                          size:(item_size_t)size
                         flags:(FileItemOptions)flags
                  creationTime:(CFAbsoluteTime)creationTime
              modificationTime:(CFAbsoluteTime)modificationTime
                    accessTime:(CFAbsoluteTime)accessTime {
  return [self initWithLabel: label
                      parent: parent
                        size: size
                        type: nil
                       flags: flags
                creationTime: creationTime
            modificationTime: modificationTime
                  accessTime: accessTime];
}

- (instancetype) initWithLabel:(NSString *)label
                        parent:(DirectoryItem *)parent
                          size:(item_size_t)size
                          type:(UniformType *)type
                         flags:(FileItemOptions)flags
                  creationTime:(CFAbsoluteTime)creationTime
              modificationTime:(CFAbsoluteTime)modificationTime
                    accessTime:(CFAbsoluteTime)accessTime {
  if (self = [super initWithLabel: label
                           parent: parent
                             size: size
                            flags: flags
                     creationTime: creationTime
                 modificationTime: modificationTime
                       accessTime: accessTime]) {
    _uniformType = [type retain];
  }
  
  return self;
}

- (void) dealloc {
  [_uniformType release];
  
  [super dealloc];
}

// Overrides abstract method in FileItem
- (FileItem *)duplicateFileItem:(DirectoryItem *)newParent {
  return [[[PlainFileItem alloc] initWithLabel: self.label
                                        parent: newParent
                                          size: self.itemSize
                                          type: self.uniformType
                                         flags: self.fileItemFlags
                                  creationTime: self.creationTime
                              modificationTime: self.modificationTime
                                    accessTime: self.accessTime] autorelease];
}

// Overrides abstract method in Item
- (void) visitFileItemDescendants:(void(^)(FileItem *))callback {
  callback(self);
}

// Overrides abstract method in Item
- (FileItem *)findFileItemDescendant:(BOOL(^)(FileItem *))predicate {
  return predicate(self) ? self : nil;
}

@end
